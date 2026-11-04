const mockUseGlobalPipes = jest.fn();
const mockListen = jest.fn().mockResolvedValue(undefined);
const mockCreate = jest.fn().mockResolvedValue({
  useGlobalPipes: mockUseGlobalPipes,
  listen: mockListen,
});

jest.mock('@nestjs/core', () => ({ NestFactory: { create: mockCreate } }));
jest.mock('./app.module', () => ({ AppModule: class {} }));

import { ValidationPipe } from '@nestjs/common';

describe('bootstrap', () => {
  it('creates the app with a global validation pipe and listens on PORT', async () => {
    process.env.PORT = '4321';
    await import('./main');
    // bootstrap() is kicked off on import; let its promise chain settle
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockCreate).toHaveBeenCalled();
    expect(mockUseGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));
    expect(mockListen).toHaveBeenCalledWith('4321');
  });
});
