export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
cd /home/jojo/projects/salon/backend
npm test 2>&1 | grep -E "✕|Tests:|Suites:" | tail -40
