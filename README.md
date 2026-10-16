# utils

個人用の業務自動化スクリプト（Google Apps Script）をまとめたリポジトリです。

## 構成

```
.
├── add-guest-automation/               # カレンダー作成イベントに応じてゲストを自動追加するGAS
├── gmail-inquiry-draft-automation/     # Gmailの問い合わせメールに返信下書きを自動作成するGAS
├── manager-line-notifications/         # マネージャー向けLINE通知（週次予定など）をまとめたGAS
└── shared/                             # 複数automationで共有するコード(スクリプトプロパティ同期など)
```

各プロジェクトのセットアップ・コマンドは、それぞれのディレクトリの `README.md` を参照してください。

## 新しいオートメーションを追加する

新規に GAS ベースの自動化を作る場合は、既存の automation（例: `gmail-inquiry-draft-automation`）を参考に実装してください。詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## 共通ツール

- pnpm: パッケージ管理（ルートの pnpm workspace で各GASプロジェクトを束ねている）。バージョンはルート `package.json` の `packageManager` で固定しており、`corepack enable` で同じバージョンが使われる（CI も同じ値を参照する）
- clasp: Google Apps Script へのデプロイ
- Biome: lint / format
- Vitest: テスト

## 依存バージョンの管理

各GASプロジェクト（`add-guest-automation`, `manager-line-notifications` など）の `typescript` / `vite` / `vitest` / `@biomejs/biome` などの devDependencies バージョンは、ルートの [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) の `catalog` で一元管理している。バージョンを上げる場合はルートの `pnpm-workspace.yaml` を編集し、ルートで `pnpm install` を実行する。

## clasp の認証ユーザーを確認する

`clasp login` の認証情報はプロジェクト単位ではなく `~/.clasprc.json` にマシン全体で保存される。名前を省略すると常に `default` アカウントが対象になるため、複数アカウントを使い分けている場合は `-u <名前>` を付けて確認する。

```bash
clasp show-authorized-user --json               # default アカウント
clasp show-authorized-user --json -u <user-name> # <user-name> という名前のアカウント
```

ログイン・push・deploy 時のアカウント切り替え方法は各プロジェクトの README（例: [gmail-inquiry-draft-automation/README.md](./gmail-inquiry-draft-automation/README.md)）を参照。
