export interface Template {
  id: number;
  name: string;
  description: string;
  headers: string[];
  sampleRows?: any[][];
}

export const TEMPLATES: Template[] = [
  {
    id: 1,
    name: 'Liability Tracker',
    description: 'Track liabilities with categories and payment methods',
    headers: ['Date', 'Description', 'Amount', 'Category', 'Payment Method', 'Notes'],
    sampleRows: [
      ['2024-01-15', 'Loan Payment', '25.50', 'Debt', 'Bank Transfer', 'Monthly payment'],
      ['2024-01-16', 'Credit Card', '45.00', 'Credit', 'Debit Card', ''],
    ],
  },
  {
    id: 2,
    name: 'Invoice Tracker',
    description: 'Manage invoices and payments',
    headers: ['Invoice #', 'Client', 'Amount', 'Date', 'Status', 'Due Date'],
    sampleRows: [
      ['INV-001', 'ABC Corp', '5000', '2024-01-10', 'Paid', '2024-01-20'],
      ['INV-002', 'XYZ Ltd', '3000', '2024-01-12', 'Pending', '2024-01-22'],
    ],
  },
  {
    id: 3,
    name: 'Inventory Tracker',
    description: 'Track inventory items and suppliers',
    headers: ['Item', 'Quantity', 'Unit Price', 'Supplier', 'Last Updated'],
    sampleRows: [
      ['Widget A', '100', '5.99', 'Supplier X', '2024-01-15'],
      ['Widget B', '50', '8.50', 'Supplier Y', '2024-01-14'],
    ],
  },
];

export const getTemplateById = (id: number): Template | undefined => {
  return TEMPLATES.find((t) => t.id === id);
};
