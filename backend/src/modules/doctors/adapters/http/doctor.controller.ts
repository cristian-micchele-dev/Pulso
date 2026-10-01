import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { actorOf } from '../../../../shared/infra/http/actor';
import { JwtAuthGuard, Roles, RolesGuard } from '../../../auth/adapters/http/auth.guards';
import { Role } from '../../../users/domain/user';
import { DoctorService } from '../../application/doctor.service';
import { CreateDoctorDto, UpdateDoctorDto, SetAvailabilityDto, CreateScheduleBlockDto } from '../../application/dto/doctor.dto';
import { PaginationDto } from '../../../../shared/application/pagination';
import { UnsupportedImageError } from '../../domain/avatar.errors';

@Controller('doctors')
@UseGuards(JwtAuthGuard)
export class DoctorController {
  constructor(private readonly service: DoctorService) {}

  @Post() @UseGuards(RolesGuard) @Roles(Role.ADMIN)
  create(@Body() dto: CreateDoctorDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('specialtyId') specialtyId?: string, @Query() pagination?: PaginationDto) {
    return this.service.findAll(specialtyId ? { specialtyId } : undefined, pagination);
  }

  @Get('me')
  findMe(@Req() req: Request) {
    return this.service.findByUserId(actorOf(req).sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id') @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDoctorDto, @Req() req: Request) {
    return this.service.update(id, dto, actorOf(req));
  }

  @Post(':id/avatar') @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  setAvatar(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new UnsupportedImageError();
    return this.service.setAvatar(id, file, actorOf(req));
  }

  @Get(':id/avatar')
  async getAvatar(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { contenido, mimeType } = await this.service.getAvatar(id);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=3600' });
    return new StreamableFile(contenido);
  }

  @Delete(':id/avatar') @HttpCode(204) @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  removeAvatar(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.service.removeAvatar(id, actorOf(req));
  }

  @Post(':id/availability') @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  setAvailability(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAvailabilityDto, @Req() req: Request) {
    return this.service.setAvailability(id, dto, actorOf(req));
  }

  @Get(':id/availability')
  getAvailability(@Param('id', ParseUUIDPipe) id: string, @Query('date') date?: string) {
    return this.service.getAvailability(id, date);
  }

  @Post(':id/blocks') @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  addBlock(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateScheduleBlockDto, @Req() req: Request) {
    return this.service.addBlock(id, dto, actorOf(req));
  }

  @Get(':id/blocks')
  getBlocks(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getBlocks(id);
  }

  @Delete(':id/blocks/:blockId') @UseGuards(RolesGuard) @Roles(Role.ADMIN, Role.DOCTOR)
  removeBlock(@Param('id', ParseUUIDPipe) id: string, @Param('blockId', ParseUUIDPipe) blockId: string, @Req() req: Request) {
    return this.service.removeBlock(id, blockId, actorOf(req));
  }
}
