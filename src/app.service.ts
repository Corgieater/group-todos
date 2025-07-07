import { Injectable } from '@nestjs/common';
import { Response } from 'express';

@Injectable()
export class AppService {
  getIndex(res: Response) {
    return res.render('index', { message: null });
  }
}
