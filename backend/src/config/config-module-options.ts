import { ConfigModuleOptions } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './env.validation';

export const configModuleOptions: ConfigModuleOptions = {
  isGlobal: true,
  cache: true,
  envFilePath: [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../.env'),
  ],
  validate: validateEnvironment,
};
