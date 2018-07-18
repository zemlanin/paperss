# paperss
Generate RSS feed of unread Instapaper articles

## Why?
Because I like to use RSS readers and Instapaper's official feed (available under "Profile > Download") truncates articles

## Prerequisites
This script needs `USERNAME` and `PASSWORD` environment variables to be set. They are used to load full articles from Instapaper

⚠️ Giving away your credentials willy-nilly is dangerous. Use this script only if you either understand everything it does or trust me ⚠️

## Running
```
$ npm install --only=prod
$ env USERNAME='your instapaper username' PASSWORD='your instapaper password' node index.js
```

## Google Cloud Functions
You can run this script as Google Cloud Function:

- Use `gcf` as the function to execute
- 128 MB of memory will be enough
