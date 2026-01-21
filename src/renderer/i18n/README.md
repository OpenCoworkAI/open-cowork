# 国际化 (i18n) 使用指南

本项目使用 `react-i18next` 实现国际化支持，支持中英文切换。

## 架构优势

✅ **代码中只用英文 key** - 无需 if-else，代码简洁  
✅ **翻译集中管理** - 所有翻译在 JSON 文件中  
✅ **类型安全** - TypeScript 支持  
✅ **自动语言检测** - 根据浏览器语言自动选择  
✅ **持久化** - 语言选择保存在 localStorage  

## 基本用法

### 1. 在组件中使用翻译

```tsx
import { useTranslation } from 'react-i18next';

function MyComponent() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('welcome.title')}</h1>
      <button>{t('common.save')}</button>
    </div>
  );
}
```

### 2. 带变量的翻译

```tsx
// en.json
{
  "welcome": {
    "greeting": "Hello, {{name}}!"
  }
}

// 使用
{t('welcome.greeting', { name: 'John' })}
```

### 3. 复数形式

```tsx
// en.json
{
  "mcp": {
    "toolsAvailable": "{{count}} tool available",
    "toolsAvailable_plural": "{{count}} tools available"
  }
}

// 使用
{t('mcp.toolsAvailable', { count: 1 })} // "1 tool available"
{t('mcp.toolsAvailable', { count: 5 })} // "5 tools available"
```

### 4. 切换语言

```tsx
import { useTranslation } from 'react-i18next';

function LanguageSwitcher() {
  const { i18n } = useTranslation();
  
  const changeLanguage = (lang: 'en' | 'zh') => {
    i18n.changeLanguage(lang);
  };
  
  return (
    <button onClick={() => changeLanguage('zh')}>中文</button>
  );
}
```

## 添加新翻译

1. 在 `src/renderer/i18n/locales/en.json` 添加英文翻译
2. 在 `src/renderer/i18n/locales/zh.json` 添加中文翻译
3. 使用 `t('key.path')` 在代码中引用

## 翻译文件结构

建议按功能模块组织：

```json
{
  "common": { ... },      // 通用词汇
  "welcome": { ... },     // 欢迎页
  "settings": { ... },    // 设置页
  "mcp": { ... },         // MCP 相关
  "credentials": { ... }  // 凭证相关
}
```

## 语言切换组件

已创建 `LanguageSwitcher` 组件，可以在任何地方使用：

```tsx
import { LanguageSwitcher } from './components/LanguageSwitcher';

<LanguageSwitcher />
```

## 最佳实践

1. **使用有意义的 key** - `welcome.title` 而不是 `text1`
2. **保持层级一致** - 英文和中文的 JSON 结构要完全一致
3. **避免硬编码** - 所有用户可见的文本都应该通过 `t()` 函数
4. **命名空间** - 使用点号分隔的层级结构组织翻译
