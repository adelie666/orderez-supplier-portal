import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { SettingsService } from './settings/settings.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async check() {
    let database = 'ok';
    let integration: { erpConfigured: boolean } | null = null;
    let demoMode = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const config = await this.settings.integration();
      integration = { erpConfigured: config.erpConfigured };
      demoMode = (await this.settings.get('demo.mode')) === 'true';
    } catch (error) {
      database = `error: ${(error as Error).message}`;
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      integration,
      demoMode,
      time: new Date().toISOString(),
    };
  }
}
