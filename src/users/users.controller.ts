import {
  Controller,
  Get,
  Post,
  Res,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'http';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(
    @Req() req: Request,
    @Body() dto: CreateUserDto,
    @Res() res: Response,
  ) {
    try {
      await this.usersService.create(dto);
      return res.redirect('/');
    } catch (e) {
      console.log('code', e.status);
      if (e.status === HttpStatus.CONFLICT) {
        console.log('2');
        // this won't work, do a flash message
        // i already set connct flash up in main,ts
        return res.render('index', {
          message: req.flash('Email already taken'),
        });
      }
    }
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(+id);
  }
}
