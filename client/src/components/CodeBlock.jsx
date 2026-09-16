import { memo } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import vs from 'react-syntax-highlighter/dist/esm/styles/prism/vs';

SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('json', json);

// Isolated in its own chunk via React.lazy so the (heavy) refractor + prism
// engine and grammars only download when the Developer code pane actually
// renders the first snippet, and then stay cached for the whole session.
const CodeBlock = memo(({ language, code, theme }) => (
  <SyntaxHighlighter
    language={language}
    style={theme === 'dark' ? vscDarkPlus : vs}
    customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.875rem' }}
  >
    {code}
  </SyntaxHighlighter>
));

export default CodeBlock;