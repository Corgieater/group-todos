import * as winston from 'winston';

const colorizer = winston.format.colorize();

export const loggerInstance = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.ms(),
  ),
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === 'production'
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.printf((info) => {
                // 1. 把 stack 抽出來單獨處理
                const {
                  timestamp,
                  level,
                  message,
                  context,
                  ms,
                  stack,
                  ...meta
                } = info;

                const pureLevel = info[Symbol.for('level')];

                // 2. 處理剩餘的 meta 物件（不包含 stack）
                const metaData = Object.keys(meta).length
                  ? `\n${JSON.stringify(meta, null, 2)}`
                  : '';

                // 3. 🚀 處理 Stack Trace：如果有 stack，就保留它的原始換行
                const stackTrace = stack ? `\n${stack}` : '';

                const ctx = typeof context === 'string' ? context : 'App';

                // 組合 Log 行，把 stackTrace 放在最後面或 meta 之後
                const logLine = `[${timestamp}] ${level} [${ctx}] ${message} ${ms}${metaData}${stackTrace}`;

                if (pureLevel === 'error') {
                  return colorizer.colorize('error', logLine);
                }

                return logLine;
              }),
            ),
    }),
  ],
});
