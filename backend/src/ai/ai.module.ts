import { Body, Controller, Delete, Get, HttpCode, Ip, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CurrencyQuery } from '../catalog/catalog.dto';
import { AuthUser, CurrentUser, JwtAuthGuard, OptionalAuthGuard } from '../common/auth';
import { AiService } from './ai.service';
import { LlmService } from './llm.service';

class ChatMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ example: '2 people, 5 days, around 1,500 AZN. Nature and city walks' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

class ChatDto extends CurrencyQuery {
  @ApiProperty({ type: [ChatMessageDto], description: 'Full conversation so far (the server is stateless)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @ApiPropertyOptional({ description: 'Echo `slots` from the previous response' })
  @IsOptional()
  @IsObject()
  slots?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Echo `plan.draft` from the previous response to refine the plan (“Make it cheaper”)' })
  @IsOptional()
  @IsObject()
  draft?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['message', 'create_plan'], description: '“Create my plan” button → create_plan' })
  @IsOptional()
  @IsIn(['message', 'create_plan'])
  action?: 'message' | 'create_plan';
}

class SavePlanDto extends CurrencyQuery {
  @ApiProperty({ description: '`plan.draft` from the chat response' })
  @IsObject()
  draft: Record<string, unknown>;

  @ApiProperty({ description: '`plan.slots` from the chat response' })
  @IsObject()
  slots: Record<string, unknown>;
}

@ApiTags('AI planner')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('discover')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Discover screen: example prompts + “Your plans”' })
  discover(@CurrentUser() user: AuthUser | null) {
    return this.ai.discover(user);
  }

  @Post('chat')
  @HttpCode(200)
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'One planner turn: slots → chips, next question(s), or a priced day-by-day plan' })
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthUser | null, @Ip() ip: string) {
    return this.ai.chat(dto, user, ip);
  }

  @Post('plans')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '“Save plan” (login required). Server re-prices the draft from catalog data.' })
  save(@CurrentUser() user: AuthUser, @Body() dto: SavePlanDto) {
    return this.ai.savePlan(user, dto.draft, dto.slots, dto.currency);
  }

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Your plans' })
  list(@CurrentUser() user: AuthUser, @Query() q: CurrencyQuery) {
    return this.ai.listPlans(user, q.currency);
  }

  @Get('plans/:id')
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: CurrencyQuery) {
    return this.ai.getPlan(user, id, q.currency);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.ai.deletePlan(user, id);
  }
}

@Module({ controllers: [AiController], providers: [AiService, LlmService] })
export class AiModule {}
