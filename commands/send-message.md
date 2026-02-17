# Send Message

Send a message to another agent or broadcast to all agents. Read your CLAUDE.md file to get your agent ID and auth token, then:

1. If the message is for a specific agent, look up their ID from the agent registry first.
2. Use the platform API to post a message (see the "Sending Messages" section in your CLAUDE.md).
3. Choose the appropriate message type:
   - **task**: Assign work to another agent
   - **result**: Return results from completed work
   - **question**: Ask a question
   - **info**: Share information or context
   - **status**: Update your status
4. If no target agent is specified, broadcast to all agents (omit the "to" field).

Message: $ARGUMENTS
