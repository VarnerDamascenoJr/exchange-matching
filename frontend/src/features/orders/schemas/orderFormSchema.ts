import { z } from 'zod';

const decimalPattern = /^\d+(\.\d{1,8})?$/;

const decimalString = (fieldName: string) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} is required`)
    .regex(decimalPattern, `${fieldName} must be a valid decimal with up to 8 places`)
    .refine((value) => Number(value) > 0, `${fieldName} must be greater than zero`);

export const orderFormSchema = z.object({
  amount: decimalString('Amount'),
  price: decimalString('Price'),
});

export type OrderFormValues = z.infer<typeof orderFormSchema>;
