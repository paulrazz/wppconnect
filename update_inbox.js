const fs = require('fs');

let content = fs.readFileSync('client/src/pages/LiveInbox.jsx', 'utf8');

// Add import
content = content.replace("import { useNavigate } from 'react-router-dom';", "import { useNavigate } from 'react-router-dom';\nimport ChatInputForm from '../components/ChatInputForm';");

// Remove state
content = content.replace("  const [replyText, setReplyText] = useState('');\n", "");
content = content.replace("  const [sending, setSending] = useState(false);\n", "");

// Replace handleSend with onMessageSent
const handleSendMatch = content.match(/  const handleSend = async \(e\) => \{[\s\S]*?  \};\n/);
if (handleSendMatch) {
  content = content.replace(handleSendMatch[0], `
  const onMessageSent = (sentMsg) => {
    setChats(prev => {
      const updated = { ...prev };
      updated[activeChatId].messages.push(sentMsg);
      return updated;
    });
  };
`);
}

// Replace the form in JSX
const formMatch = content.match(/            \{\/\* Chat Input \*\/\}\n            <form onSubmit=\{handleSend\}[\s\S]*?<\/form>\n/);
if (formMatch) {
  content = content.replace(formMatch[0], `            {/* Chat Input */}\n            <ChatInputForm activeChatId={activeChatId} apiKey={apiKey} API_URL={API_URL} onMessageSent={onMessageSent} />\n`);
}

fs.writeFileSync('client/src/pages/LiveInbox.jsx', content);
