import { BadRequestException, HttpException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * Validation errors are returned per field so the iOS app can show red text
 * under the matching input (PDF §3):
 * { statusCode: 400, error: "ValidationError", message: "...", fields: { email: "Enter a valid email address." } }
 */
function flatten(errors: ValidationError[], parent = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors) {
    const key = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      const msgs = Object.values(e.constraints);
      out[key] = msgs[msgs.length - 1];
    }
    if (e.children?.length) Object.assign(out, flatten(e.children, key));
  }
  return out;
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => {
      const fields = flatten(errors);
      return new BadRequestException({
        statusCode: 400,
        error: 'ValidationError',
        message: Object.values(fields)[0] ?? 'Invalid request',
        fields,
      });
    },
  });
}

export function fieldError(field: string, message: string, status = 400) {
  const error = status === 409 ? 'Conflict' : status === 404 ? 'NotFound' : 'ValidationError';
  return new HttpException({ statusCode: status, error, message, fields: { [field]: message } }, status);
}
