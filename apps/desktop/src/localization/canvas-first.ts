import type { Catalog } from './types';
export const canvasFirst = {
  'board.title': { en: 'Canvas', zh: '画布' },
  'board.more': { en: 'Project actions', zh: '工程操作' },
  'board.media': { en: 'Media library', zh: '素材库' },
  'board.newSequence': { en: 'New sequence', zh: '新建作品' },
  'board.import': { en: 'Add media', zh: '添加素材' },
  'board.empty': { en: 'Make room for your next idea.', zh: '在这里展开你的下一个想法。' },
  'board.emptyHint': {
    en: 'Drop references here. Tell Framo what you want to make.',
    zh: '拖入参考素材，告诉 Framo 你想创作什么。',
  },
  'board.dropFiles': { en: 'Drop to add your media', zh: '放下以添加素材' },
  'board.dropSequence': { en: 'Drop to add to this film', zh: '放下以加入作品' },
  'board.reference': { en: 'Drag {name} to the conversation', zh: '将 {name} 拖到对话中' },
  'board.dragHint': {
    en: 'Drag media onto a film to add a shot',
    zh: '将素材拖到作品上以添加镜头',
  },
  'conversation.title': { en: 'Conversation', zh: '对话' },
  'conversation.history': { en: 'Conversation history', zh: '对话历史' },
  'conversation.more': { en: 'Conversation options', zh: '对话选项' },
  'conversation.drop': { en: 'Drop a reference for Framo', zh: '放下卡片作为 Framo 的参考' },
  'conversation.clear': { en: 'Remove context', zh: '移除参考' },
  'conversation.review': { en: 'Your approval', zh: '等待你的确认' },
  'conversation.archive': { en: 'Review history', zh: '审阅历史' },
  'conversation.workflowArchive': { en: 'Workflow history', zh: '工作流历史' },
  'conversation.welcome': { en: 'What are we making?', zh: '这次想创作什么？' },
  'conversation.welcomeHint': {
    en: 'Share an idea, or drag a reference from the canvas.',
    zh: '描述一个想法，或从画布拖入参考素材。',
  },
  'board.welcome': { en: 'An idea. A canvas. Your film.', zh: '一个想法，一张画布，一部作品。' },
  'board.welcomeHint': {
    en: 'A quiet space to create with Framo.',
    zh: '与 Framo 一起创作的简单空间。',
  },
} as const satisfies Catalog;
