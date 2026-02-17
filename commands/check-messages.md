# Check Messages

Check for new messages from other agents and the user. Read your CLAUDE.md file to get your agent ID and auth token, then:

1. Fetch your unread messages using the platform API (see the "Checking Messages" section in your CLAUDE.md).
2. For each unread message, process it based on its type:
   - **task**: Start working on it. Post a status update, then post the result when done.
   - **question**: Answer it by sending a `result` message back to the sender.
   - **info**: Acknowledge it and incorporate the information into your work.
   - **status**: Note what other agents are doing to avoid duplicate work.
   - **result**: Read the result and continue your work accordingly.
3. Mark each message as read after processing.
4. If there are no messages, say so briefly.

$ARGUMENTS
