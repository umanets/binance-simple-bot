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
  lotCount: number;

  @Type(() => Number)
  @IsNumber()
  price: number;

  buyCoef: number | undefined;
  sellCoef: number | undefined;
}
