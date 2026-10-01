import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { actorOf } from '../../../../shared/infra/http/actor';
import { attachment } from '../../../../shared/infra/http/content-disposition';
import { JwtAuthGuard, Roles, RolesGuard } from '../../../auth/adapters/http/auth.guards';
import { Role } from '../../../users/domain/user';
import { MedicalReportService } from '../../application/medical-report.service';
import { CreateMedicalReportDto } from '../../application/dto/create-medical-report.dto';
import { CreatePatientReportDto } from '../../application/dto/create-patient-report.dto';
import { QueryMedicalReportsDto } from '../../application/dto/query-medical-reports.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class MedicalReportController {
  constructor(private readonly service: MedicalReportService) {}

  @Post('appointments/:appointmentId/reports')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  upload(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CreateMedicalReportDto,
    @Req() req: Request,
  ) {
    const file = (req as Request & { file: Express.Multer.File }).file;
    return this.service.upload(actorOf(req).sub, appointmentId, dto, file);
  }

  @Get('appointments/:appointmentId/reports')
  findByAppointment(
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Query() _query: QueryMedicalReportsDto,
    @Req() req: Request,
  ) {
    return this.service.findByAppointment(appointmentId, actorOf(req));
  }

  @Get('reports/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.findOne(id, actorOf(req));
  }

  @Get('reports/:id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const actor = actorOf(req);
    // Una sola llamada: trae el contenido y el informe juntos, ya con el
    // permiso verificado. Si el archivo no esta, lanza ArchivoNoEncontradoError
    // y el filtro de errores lo convierte en un 404 con mensaje propio, en vez
    // de reventar el stream a mitad de la respuesta como hacia antes.
    const { contenido, report } = await this.service.readFile(id, actor);

    res.set({
      'Content-Type': report.mimeType,
      'Content-Disposition': attachment(report.originalName),
    });

    return new StreamableFile(contenido);
  }

  @Get('patients/:patientId/reports')
  async findByPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    return this.service.findByPatient(patientId, page, limit, actorOf(req));
  }

  @Post('patients/:patientId/reports')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        cb(null, allowed.includes(file.mimetype));
      },
    }),
  )
  uploadForPatient(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreatePatientReportDto,
    @Req() req: Request,
  ) {
    const file = (req as Request & { file: Express.Multer.File }).file;
    return this.service.uploadForPatient(actorOf(req).sub, patientId, dto, file);
  }

  @Delete('reports/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.DOCTOR)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.service.delete(id, actorOf(req).sub);
  }
}
