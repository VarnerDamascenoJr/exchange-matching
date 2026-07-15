import { z } from 'zod';

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Username is required')
    .max(50, 'Username must have at most 50 characters'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
