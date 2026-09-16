import sys
import re

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

# 1. Fetch more chats by default (limit=500)
content = content.replace("axios.get(`${API_URL}/chats`,", "axios.get(`${API_URL}/chats?limit=500`,")
content = content.replace("axios.get(`${API_URL}/inbox/chats`,", "axios.get(`${API_URL}/inbox/chats?limit=500`,")

# 2. Add state for chatDisplayLimit
if "const [chatDisplayLimit, setChatDisplayLimit] = useState(20);" not in content:
    content = content.replace("const [sidebarTab, setSidebarTab] = useState('chats');", "const [sidebarTab, setSidebarTab] = useState('chats');\n  const [chatDisplayLimit, setChatDisplayLimit] = useState(20);")

# 3. Apply the slice and add the button
# We currently have: `activeRows.slice(0, 150).map(chat => {`
# We change it to `activeRows.slice(0, chatDisplayLimit).map(chat => {`
content = content.replace("activeRows.slice(0, 150).map(chat => {", "activeRows.slice(0, chatDisplayLimit).map(chat => {")

# Add the Load More button after the map
button_html = """                  </button>
                );
              })}
              {activeRows.length > chatDisplayLimit && (
                <button
                  onClick={() => setChatDisplayLimit(prev => prev + 5)}
                  className={`w-full py-2 text-xs font-semibold text-center rounded-lg mt-2 transition-colors ${theme === 'dark' ? 'bg-[#1a1f28] text-indigo-400 hover:bg-[#232a35]' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                >
                  Load more (+{activeRows.length - chatDisplayLimit} left)
                </button>
              )}
            </div>
          )}
        </div>"""

content = re.sub(r'                  </button>\n                \);\n              \}\)\}', button_html, content)

with open(path, 'w') as f:
    f.write(content)

