import { z } from 'zod';
import {
  decimalFitsSchema,
  multiplyDecimals,
  parseDecimal,
} from '../../../utils/decimal';

const decimalPattern = /^\d+(\.\d{1,8})?$/;

const decimalString = (fieldName: string) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} is required`)
    .regex(decimalPattern, `${fieldName} must be a valid decimal with up to 8 places`)
    .refine(decimalFitsSchema, `${fieldName} must fit within DECIMAL(28,8)`)
    .refine(
      (value) => parseDecimal(value).gt(0),
      `${fieldName} must be greater than zero`,
    );

export const orderFormSchema = z
  .object({
    amount: decimalString('Amount'),
    price: decimalString('Price'),
  })
  .superRefine(({ amount, price }, context) => {
    if (
      !decimalPattern.test(amount) || !decimalPattern.test(price) ||
      !decimalFitsSchema(amount) || !decimalFitsSchema(price)
    ) {
      return;
    }
    const cost = multiplyDecimals(amount, price);
    if (parseDecimal(cost).lte(0)) {
      context.addIssue({
        code: 'custom', path: ['price'],
        message: 'Order cost must be at least 0.00000001 USD',
      });
    } else if (!decimalFitsSchema(cost)) {
      context.addIssue({
        code: 'custom', path: ['price'],
        message: 'Order cost must fit within DECIMAL(28,8)',
      });
    }
  });

export type OrderFormValues = z.infer<typeof orderFormSchema>;
