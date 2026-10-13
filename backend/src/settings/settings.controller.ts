import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SETTING_KEYS, SettingsService } from './settings.service';
import { DEFAULT_SUPPLIER_FIELD } from '../common/supplier-match.util';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** 返回配置：敏感项打码，只回传是否已配置 */
  @Get()
  async read() {
    const map = await this.settings.all();
    const integration = await this.settings.integration();
    const mask = (v?: string) => (v && v.trim() ? `****${v.trim().slice(-4)}` : '');

    return {
      values: {
        baseUrl: map[SETTING_KEYS.erpBaseUrl] ?? '',
        serialNumber: mask(map[SETTING_KEYS.erpSerialNumber]),
        password: mask(map[SETTING_KEYS.erpPassword]),
        supplierField: map[SETTING_KEYS.supplierField]?.trim() || DEFAULT_SUPPLIER_FIELD,
      },
      status: {
        configured: integration.erpConfigured,
        baseUrl: integration.erpBaseUrl,
        supplierField: (map[SETTING_KEYS.supplierField]?.trim() || DEFAULT_SUPPLIER_FIELD) as string,
      },
    };
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    const entries: Record<string, string | undefined> = {};
    // 打码值（含 *）视为「不修改」
    const put = (key: string, value?: string) => {
      if (value === undefined) return;
      if (value.includes('*')) return;
      entries[key] = value;
    };

    put(SETTING_KEYS.erpBaseUrl, dto.baseUrl);
    put(SETTING_KEYS.erpSerialNumber, dto.serialNumber);
    put(SETTING_KEYS.erpPassword, dto.password);
    // Il campo fornitore puo' essere svuotato di proposito: qui non vale il filtro sul valore mascherato.
    if (dto.supplierField !== undefined) entries[SETTING_KEYS.supplierField] = dto.supplierField;

    await this.settings.setMany(entries);
    return this.read();
  }

  /** 「Verifica connessione」：只取 token，验证 SerialNumber / Password 是否有效 */
  @Post('test')
  @HttpCode(200)
  async test() {
    return this.settings.testConnection();
  }
}
