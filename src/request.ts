import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class TWAlertDto {
  /** Shared secret matched against the ALERT_TOKEN env var when that is set. */
  @IsOptional()
  @IsString()
  token?: string;

  @IsString()
  ticker: string;

  @IsIn(['aBuy', 'aSell', 'fBuy', 'fSell'])
  direction: 'aBuy' | 'aSell' | 'fBuy' | 'fSell';

  @Type(() => Number)
  @IsNumber()
  price: number;

  @Type(() => Number)
  @IsNumber()
  buyCoef: number;

  @Type(() => Number)
  @IsNumber()
  sellCoef: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  atr?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stdev?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  volRatio?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  reliability?: number;

  @IsOptional()
  @IsString()
  tfDir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tfUpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tfLowerVal?: number;

  @IsOptional()
  @IsString()
  tf1Dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf1UpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf1LowerVal?: number;

  @IsOptional()
  @IsString()
  tf2Dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf2UpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf2LowerVal?: number;

  @IsOptional()
  @IsString()
  tf3Dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf3UpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf3LowerVal?: number;

  @IsOptional()
  @IsString()
  tf4Dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf4UpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf4LowerVal?: number;

  @IsOptional()
  @IsString()
  tf5Dir?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf5UpperVal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tf5LowerVal?: number;
}
