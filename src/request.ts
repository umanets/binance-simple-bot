/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Type } from 'class-transformer';
import { IsString, IsIn, IsNumber, IsOptional } from 'class-validator';

export class TWAlertDto {
  @IsString()
  ticker: string;

  @IsIn(['aBuy', 'aSell', 'fBuy', 'fSell', 'dBuy', 'dSell'])
  direction: 'aBuy' | 'aSell' | 'fBuy' | 'fSell' | 'dBuy' | 'dSell';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price: number;
  
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  sl: number;

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
