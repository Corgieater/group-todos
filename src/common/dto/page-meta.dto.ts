import { PageOptionsDto } from './page-options.dto';

export class PageMetaDto {
  readonly page: number;
  readonly limit: number;
  readonly itemCount: number;
  readonly pageCount: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;

  constructor(pageOptionsDto: PageOptionsDto, itemCount: number) {
    this.page = pageOptionsDto.page ?? 1;
    this.limit = pageOptionsDto.limit ?? 10;
    this.itemCount = itemCount;
    this.pageCount = Math.ceil(this.itemCount / this.limit);
    this.hasPreviousPage = this.page > 1;
    this.hasNextPage = this.page < this.pageCount;
  }
}
