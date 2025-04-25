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
}
