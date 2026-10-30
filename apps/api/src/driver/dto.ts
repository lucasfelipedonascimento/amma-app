import { DOCUMENT_TYPES, GENDERS, type DocumentType, type Gender } from '@amma/shared';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class DriverProfileDto {
  @IsString() @MinLength(5) fullName!: string;
  @IsString() cpf!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'birthDate deve ser AAAA-MM-DD' }) birthDate!: string;
  /** Autodeclarado. Só vale para a opção "motorista mulher" depois de conferido pela associação. */
  @IsOptional() @IsIn(GENDERS) gender?: Gender;
}

export class VehicleDto {
  @IsIn(['MOTO', 'CARRO']) type!: 'MOTO' | 'CARRO';
  @IsString() plate!: string;
  @IsString() @MinLength(2) model!: string;
  @Type(() => Number) @IsInt() year!: number;
}

export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES) type!: DocumentType;
  @IsOptional() @IsUUID() vehicleId?: string;
}

export class GenderDto {
  @IsIn(GENDERS) gender!: Gender;
}
