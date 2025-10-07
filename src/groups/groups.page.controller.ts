import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { GroupsService } from './groups.service';
import { buildGroupVM } from 'src/common/helpers/util';
import { GroupsPageFilter } from 'src/common/filters/group-page.filter';

@Controller('groups')
@UseGuards(AccessTokenGuard)
@UseFilters(GroupsPageFilter)
export class GroupsPageController {
  constructor(private groupsService: GroupsService) {}

  @Get('new')
  async getCreateForm(@Req() req: Request, @Res() res: Response) {
    return res.render('groups/new');
  }

  @Get(':id/invitation')
  async getInviteForm(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    return res.render('groups/invite', { id });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    // i think i can change by owner to by menber
    const group = await this.groupsService.getGroupDetailsByMemberId(
      id,
      user.userId,
    );
    const viewModel = buildGroupVM(group, user.timeZone);
    res.render('groups/details', {
      group: {
        id: viewModel.id,
        name: viewModel.name,
        createdAtLabel: viewModel.createdAtLabel,
        updatedAtLabel: viewModel.updatedAtLabel,
      },
      owner: viewModel.owner,
      members: viewModel.members,
      isOwner: viewModel.ownerId === user.userId,
    });
  }
}
