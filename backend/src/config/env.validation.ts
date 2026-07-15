type EnvironmentVariables = {
  NODE_ENV?: string;
  PORT?: string | number;
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: string | number;
  POSTGRES_DB?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  JWT_EXPIRES_IN?: string;
  REDIS_HOST?: string;
  REDIS_PORT?: string | number;
};

const parseNumber = (
  value: string | number | undefined,
  key: string,
): number => {
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  const parsedValue =
    typeof value === 'number' ? value : Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }

  return parsedValue;
};

const parseString = (value: string | undefined, key: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const parseDatabaseUrl = (value: string | undefined): string => {
  const databaseUrl = parseString(value, 'DATABASE_URL');

  try {
    const parsedUrl = new URL(databaseUrl);

    if (!['postgresql:', 'postgres:'].includes(parsedUrl.protocol)) {
      throw new Error(
        'Environment variable DATABASE_URL must use the postgresql protocol',
      );
    }

    return databaseUrl;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Environment variable DATABASE_URL must be a valid URL');
    }

    throw error;
  }
};

export function validateEnvironment(config: EnvironmentVariables) {
  const nodeEnv = config.NODE_ENV ?? 'development';

  if (nodeEnv === 'test') {
    return {
      NODE_ENV: nodeEnv,
      PORT: config.PORT ? parseNumber(config.PORT, 'PORT') : 3000,
      JWT_SECRET: config.JWT_SECRET ?? 'test-jwt-secret',
      JWT_EXPIRES_IN: config.JWT_EXPIRES_IN ?? '1h',
    };
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: config.PORT ? parseNumber(config.PORT, 'PORT') : 3000,
    POSTGRES_HOST: parseString(config.POSTGRES_HOST, 'POSTGRES_HOST'),
    POSTGRES_PORT: parseNumber(config.POSTGRES_PORT, 'POSTGRES_PORT'),
    POSTGRES_DB: parseString(config.POSTGRES_DB, 'POSTGRES_DB'),
    POSTGRES_USER: parseString(config.POSTGRES_USER, 'POSTGRES_USER'),
    POSTGRES_PASSWORD: parseString(
      config.POSTGRES_PASSWORD,
      'POSTGRES_PASSWORD',
    ),
    DATABASE_URL: parseDatabaseUrl(config.DATABASE_URL),
    JWT_SECRET: parseString(config.JWT_SECRET, 'JWT_SECRET'),
    JWT_EXPIRES_IN: parseString(config.JWT_EXPIRES_IN, 'JWT_EXPIRES_IN'),
    REDIS_HOST: parseString(config.REDIS_HOST, 'REDIS_HOST'),
    REDIS_PORT: parseNumber(config.REDIS_PORT, 'REDIS_PORT'),
  };
}
