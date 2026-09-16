import sys

path = 'client/src/pages/LiveInbox.jsx'
with open(path, 'r') as f:
    content = f.read()

target = """                  </button>
                );
              })
          )}
        </div>"""

repl = """                  </button>
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

content = content.replace(target, repl)

with open(path, 'w') as f:
    f.write(content)

