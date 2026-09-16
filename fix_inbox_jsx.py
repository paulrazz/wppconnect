import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

# Add the state
if "const [chatDisplayLimit, setChatDisplayLimit] = useState(20);" not in content:
    content = content.replace("const [sidebarTab, setSidebarTab] = useState('chats');", "const [sidebarTab, setSidebarTab] = useState('chats');\n  const [chatDisplayLimit, setChatDisplayLimit] = useState(20);")
    
# Change the query params
content = content.replace("axios.get(`${API_URL}/chats`,", "axios.get(`${API_URL}/chats?limit=500`,")
content = content.replace("axios.get(`${API_URL}/inbox/chats`,", "axios.get(`${API_URL}/inbox/chats?limit=500`,")

# Fix the JSX wrapper
target_start = "          ) : (\n            activeRows.slice(0, 150).map(chat => {"
repl_start = "          ) : (\n            <>\n              {activeRows.slice(0, chatDisplayLimit).map(chat => {"
content = content.replace(target_start, repl_start)

target_end = """                  </button>
                );
              })
          )}
        </div>"""

repl_end = """                  </button>
                );
              })}
              {activeRows.length > chatDisplayLimit && (
                <div className="p-3">
                  <button
                    onClick={() => setChatDisplayLimit(prev => prev + 5)}
                    className={`w-full py-2 text-xs font-semibold text-center rounded-lg transition-colors ${theme === 'dark' ? 'bg-[#1a1f28] text-indigo-400 hover:bg-[#232a35]' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                  >
                    Load more (+{activeRows.length - chatDisplayLimit} left)
                  </button>
                </div>
              )}
            </>
          )}
        </div>"""

content = content.replace(target_end, repl_end)

with open(path, 'w') as f:
    f.write(content)

