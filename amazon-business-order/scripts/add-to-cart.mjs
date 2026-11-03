// 定期実行（クラウド）で使う: 注文リストの「未処理」をAmazonビジネスのカートに追加する。注文の確定はしない。
// 確定はAmazonアプリで人が行う暫定運用のため、このスクリプトはレジへ進むことすらしない。
// 使い方: AMAZON_STORAGE_STATE_B64=... node add-to-cart.mjs <orders.json> <出力ディレクトリ>
//   orders.json: [{ "receiptId": "AB3CD", "asin": "B000000000", "quantity": 2, "priceCap": 1000 | null }]
//   標準出力: 1注文1行のJSON（{ receiptId, status, unitPrice, note, processedAt }）。status は カート追加済 / 要確認 / 失敗
//   processedAt はその注文を処理し終えた日本時間（yyyy/MM/dd HH:mm:ss）。シートの「処理日時」にそのまま書く
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const [ordersPath, outDir = "."] = process.argv.slice(2);
if (!ordersPath) {
  console.error("orders.json のパスを指定してください");
  process.exit(2);
}
const orders = JSON.parse(readFileSync(ordersPath, "utf8"));
const b64 = process.env.AMAZON_STORAGE_STATE_B64;
if (!b64) {
  console.error("AMAZON_STORAGE_STATE_B64 が設定されていません。");
  process.exit(2);
}
const storageState = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

// ---- ガードレール（変更禁止）: 注文確定・即時購入・レジ遷移に当たる通信を通信レベルで遮断する ----
const FORBIDDEN = /place-?order|placeYourOrder|static-submit|turbo-checkout|buy-?now|one-?click|1-click|\/checkout\//i;
const browser = await chromium.launch();
const context = await browser.newContext({ storageState, locale: "ja-JP" });
await context.route("**/*", (route) => {
  const request = route.request();
  const isNavigationOrPost = request.method() !== "GET" || request.isNavigationRequest();
  if (isNavigationOrPost && FORBIDDEN.test(request.url())) return route.abort();
  return route.continue();
});
// ------------------------------------------------------------------------------------------
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` }).catch(() => {});
const isAuthWall = () => /\/ap\/(signin|mfa|cvf)|captcha/i.test(page.url());

// カート内の対象ASINの数量（無ければ0）。保存済み・後で買う欄を除くため #sc-active-cart に限定する。
async function cartQuantity(asin) {
  await page.goto("https://www.amazon.co.jp/gp/cart/view.html", { waitUntil: "domcontentloaded" });
  if (isAuthWall()) throw new Error("AUTH");
  const row = page.locator(`#sc-active-cart [data-asin="${asin}"][data-quantity]`).first();
  if ((await row.count()) === 0) return 0;
  return Number(await row.getAttribute("data-quantity")) || 0;
}

// 数量の select は aok-hidden（display:none）で、画面にはカスタムドロップダウンが表示される。
// 通常の selectOption は可視化を待ち続けてタイムアウトするため、表示中のドロップダウンを操作する。
// ドロップダウンの要素IDは実行ごとに変わりうるため、select を含むコンテナから辿る。
// 操作できなかった場合のみ、非表示の select へ直接値を設定する（カートに入れる際はこの値が送られる）。
async function chooseQuantity(select, quantity) {
  const container = page.locator("span.a-dropdown-container", { has: page.locator("select#quantity, select[name='quantity']") }).first();
  try {
    await container.locator(".a-button-dropdown, [data-action='a-dropdown-button']").first().click({ timeout: 5000 });
    const option = page
      .locator(".a-popover:visible a.a-dropdown-link")
      .filter({ hasText: new RegExp(`^\\s*${quantity}\\s*$`) })
      .first();
    await option.click({ timeout: 5000 });
  } catch {
    // フォールバックへ進む
  }
  if ((await select.inputValue()) !== String(quantity)) {
    await select.selectOption(String(quantity), { force: true, timeout: 5000 }).catch(() => {});
  }
  return (await select.inputValue()) === String(quantity);
}

// 書き戻す「処理日時」をモデルに組み立てさせると時刻がずれるため、スクリプトが実時刻を出す。
function formatJstNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseYen(text) {
  const digits = (text ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

async function addOne(order) {
  const { receiptId, asin, quantity, priceCap } = order;
  if (!/^[A-Z0-9]{10}$/.test(asin ?? "") || !(quantity >= 1)) {
    return { status: "失敗", note: "ASINまたは数量が不正です" };
  }
  const before = await cartQuantity(asin);

  await page.goto(`https://www.amazon.co.jp/dp/${asin}`, { waitUntil: "domcontentloaded" });
  if (isAuthWall()) throw new Error("AUTH");
  const availability = (await page.locator("#availability").innerText().catch(() => "")).trim();
  const unitPrice = parseYen(
    await page.locator("#corePrice_feature_div .a-offscreen, #apex_desktop .a-offscreen, .a-price .a-offscreen").first().innerText().catch(() => ""),
  );
  await shot(`${receiptId}-product`);

  if (/在庫切れ|現在お取り扱いできません|入荷時期は未定/.test(availability)) {
    return { status: "要確認", unitPrice, note: `在庫なし（${availability.slice(0, 30)}）` };
  }
  // 価格上限は税込の合計額。商品ページの表示が税抜の場合もあるため、超過時は追加せず人に確認させる。
  if (priceCap && unitPrice && unitPrice * quantity > priceCap) {
    return { status: "要確認", unitPrice, note: `価格上限超過（表示単価${unitPrice}円×${quantity} > 上限${priceCap}円）` };
  }
  const addButton = page.locator("#add-to-cart-button");
  if ((await addButton.count()) === 0) {
    return { status: "要確認", unitPrice, note: "「カートに入れる」ボタンが見つかりません" };
  }
  if (quantity > 1) {
    const select = page.locator("select#quantity, select[name='quantity']").first();
    const hasOption = (await select.count()) > 0 && (await select.locator(`option[value="${quantity}"]`).count()) > 0;
    if (!hasOption) return { status: "要確認", unitPrice, note: `数量${quantity}を選択できません` };
    if (!(await chooseQuantity(select, quantity))) {
      return { status: "要確認", unitPrice, note: `数量${quantity}を選択できませんでした` };
    }
  }
  await addButton.click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  await shot(`${receiptId}-added`);

  const after = await cartQuantity(asin);
  if (after - before !== quantity) {
    return { status: "要確認", unitPrice, note: `カート内数量が想定と異なります（追加前${before}→追加後${after}、依頼${quantity}）` };
  }
  const priceNote = unitPrice ? `商品ページ表示単価${unitPrice}円。` : "";
  return { status: "カート追加済", unitPrice, note: `${priceNote}Amazonアプリで注文を確定してください` };
}

let exitCode = 0;
for (const order of orders) {
  let result;
  try {
    result = await addOne(order);
  } catch (error) {
    const auth = String(error?.message) === "AUTH";
    result = { status: "失敗", note: auth ? "ログインが切れています（Cookieの再書き出しが必要）" : `エラー: ${String(error).split("\n")[0].slice(0, 100)}` };
    exitCode = 1;
    await shot(`${order.receiptId}-error`);
    if (auth) {
      console.log(JSON.stringify({ receiptId: order.receiptId, unitPrice: null, ...result, processedAt: formatJstNow() }));
      // ログイン切れは以降の注文も同じ結果になるため、残りは処理せず「未処理」のまま残す。
      break;
    }
  }
  console.log(JSON.stringify({ receiptId: order.receiptId, unitPrice: null, ...result, processedAt: formatJstNow() }));
}
await browser.close();
process.exit(exitCode);
