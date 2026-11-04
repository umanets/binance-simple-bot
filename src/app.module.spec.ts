import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { AppController } from './app.controller';

describe('AppModule', () => {
  it('compiles the full dependency graph', async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef.get(AppController)).toBeDefined();
  });
});
