type PersonPayment = {
  personName: string;
  amount: number;
};

type MonthlyPayrollResult = {
  workMonth: string;
  paymentDueDate: Date;
  paymentStatus: string;
  payments: PersonPayment[];
};

export type { MonthlyPayrollResult, PersonPayment };
