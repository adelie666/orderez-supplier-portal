import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  summary(@Query() query: ReportQueryDto, @CurrentUser() user: JwtPayload) {
    return this.reports.summary(query, user);
  }

  @Get('export')
  async export(@Query() query: ReportQueryDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { filename, buffer } = await this.reports.exportExcel(query, user);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }
}
