import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { loggingConfig } from './shared/infra/logging/logging.config';
import { MetricsModule } from './shared/infra/metrics/metrics.module';
import { FileStorageModule } from './shared/infra/files/file-storage.module';
import configuration from './config/configuration';
import { validateEnv } from './config/env.schema';
import { HealthController } from './shared/infra/http/health.controller';
import { UserOrmEntity, AuthSessionOrmEntity, ResetTokenOrmEntity } from './modules/users/adapters/persistence/entities';
import { SpecialtyOrmEntity } from './modules/specialties/adapters/persistence/specialty.entity';
import { DoctorOrmEntity, AvailabilityOrmEntity, ScheduleBlockOrmEntity } from './modules/doctors/adapters/persistence/doctor.entity';
import { PatientOrmEntity } from './modules/patients/adapters/persistence/patient.entity';
import { AppointmentOrmEntity } from './modules/appointments/adapters/persistence/appointment.entity';
import { MedicalReportOrmEntity } from './modules/medical-reports/adapters/persistence/medical-report.entity';
import { PrescriptionOrmEntity } from './modules/prescriptions/adapters/persistence/prescription.entity';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SpecialtiesModule } from './modules/specialties/specialties.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { PatientsModule } from './modules/patients/patients.module';
import { MessagesModule } from './modules/messages/messages.module';
import { MessageOrmEntity } from './modules/messages/adapters/persistence/message.entity';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationOrmEntity } from './modules/notifications/adapters/persistence/notification.entity';
import { AppointmentCommentOrmEntity } from './modules/appointments/adapters/persistence/appointment-comment.entity';
import { AuditLogOrmEntity } from './modules/audit/adapters/persistence/audit.entity';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { MedicalReportsModule } from './modules/medical-reports/medical-reports.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    ScheduleModule.forRoot(),
    // Configurable porque el limite correcto depende del despliegue: detras de un
    // balanceador todo el trafico llega de una sola IP, y en una prueba de carga
    // el limitador taparia justo lo que se quiere medir.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{ name: 'default', ...config.getOrThrow('throttle') }],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow('databaseUrl'),
        entities: [UserOrmEntity, AuthSessionOrmEntity, ResetTokenOrmEntity, SpecialtyOrmEntity, DoctorOrmEntity, AvailabilityOrmEntity, ScheduleBlockOrmEntity, PatientOrmEntity, AuditLogOrmEntity, NotificationOrmEntity, MessageOrmEntity, AppointmentOrmEntity, AppointmentCommentOrmEntity, MedicalReportOrmEntity, PrescriptionOrmEntity],
        synchronize: false,
        // Cada instancia se lleva hasta DB_POOL_MAX conexiones, y el servidor tiene
        // un max_connections finito: N instancias por el pool no puede superarlo.
        // Con el default de 10 y los 60 de Supabase, el techo son ~4 instancias.
        extra: { max: config.getOrThrow<number>('dbPoolMax') },
      }),
    }),
    LoggerModule.forRoot(loggingConfig()),
    MetricsModule,
    FileStorageModule,
    SharedModule,
    AuthModule,
    UsersModule,
    SpecialtiesModule,
    DoctorsModule,
    PatientsModule,
    AuditModule,
    MessagesModule,
    AppointmentsModule,
    DashboardModule,
    MedicalReportsModule,
    PrescriptionsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
