/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Type } from 'class-transformer';
import { IsString, IsIn, IsNumber } from 'class-validator';

export class TWAlertDto {
  @IsString()
  ticker: string;

  @IsIn(['aBuy', 'aSell'])
  direction: 'aBuy' | 'aSell';

  @Type(() => Number)
  @IsNumber()
  price: number;

  @Type(() => Number)
  @IsNumber()
  buyCoef: number;

  @Type(() => Number)
  @IsNumber()
  sellCoef: number;

  @Type(() => Number)
  @IsNumber()
  atr: number;

  @Type(() => Number)
  @IsNumber()
  stdev: number;

  @Type(() => Number)
  @IsNumber()
  volRatio: number;

  @Type(() => Number)
  @IsNumber()
  reliability: number;

  @IsString()
  tfDir: string;

  @Type(() => Number)
  @IsNumber()
  tfUpperVal: number;

  @Type(() => Number)
  @IsNumber()
  tfLowerVal: number;
  @IsString()
  tf1Dir: string;
  @Type(() => Number)
  @IsNumber()
  tf1UpperVal: number;

  @Type(() => Number)
  @IsNumber()
  tf1LowerVal: number;

  @IsString()
  tf2Dir: string;

  @Type(() => Number)
  @IsNumber()
  tf2UpperVal: number;

  @Type(() => Number)
  @IsNumber()
  tf2LowerVal: number;

  @IsString()
  tf3Dir: string;

  @Type(() => Number)
  @IsNumber()
  tf3UpperVal: number;

  @Type(() => Number)
  @IsNumber()
  tf3LowerVal: number;

  @IsString()
  tf4Dir: string;

  @Type(() => Number)
  @IsNumber()
  tf4UpperVal: number;

  @Type(() => Number)
  @IsNumber()
  tf4LowerVal: number;

  @IsString()
  tf5Dir: string;

  @Type(() => Number)
  @IsNumber()
  tf5UpperVal: number;
  
  @Type(() => Number)
  @IsNumber()
  tf5LowerVal: number;
}
