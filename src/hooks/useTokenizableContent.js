import { useMemo } from 'preact/hooks';
// asciiTree is not used here anymore, it's used by usePromptBuilder to create userPromptText

// buildUserPromptInternal is removed.
// The hook now expects userPromptText (the main text part of the user's next message) as an argument.

export function useTokenizableContent(
    currentChatMessages,
    userPromptText, // This is the pre-constructed text from usePromptBuilder
    currentPendingPDFs,
    isSending // New parameter to indicate if a message is currently being sent
) {
    return useMemo(() => {
        const itemsForApiCount = [];

        // 1. Add existing chat messages
        // This will include the new user message after an optimistic update if isSending is true.
        if (currentChatMessages && currentChatMessages.length > 0) {
            currentChatMessages.forEach(msg => {
                const contentBlocks = Array.isArray(msg.content)
                    ? msg.content
                    : [{ type: 'text', text: String(msg.content ?? '') }];

                contentBlocks.forEach(block => {
                    if (block.type === 'text' && block.text && String(block.text).trim() !== "") {
                        itemsForApiCount.push({ type: 'text', value: block.text });
                    } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type && block.file.mime_type.includes('pdf')) {
                        // This handles PDFs already part of previous messages
                        itemsForApiCount.push({ type: 'pdf', uri: block.file.file_id, mimeType: block.file.mime_type });
                    }
                    // Image blocks from previous messages are not directly tokenized by countTokens API
                    // Their token cost is estimated separately in App.jsx
                });
            });
        }

        // 2. If NOT currently sending, add the content for the next message from the prompt builder state.
        //    If isSending is true, this content is assumed to be part of currentChatMessages due to optimistic update.
        if (!isSending) {
            // Add the main user prompt text (which now includes form inputs, file contents, and file tree)
            if (userPromptText && String(userPromptText).trim() !== "") {
                itemsForApiCount.push({ type: 'text', value: userPromptText });
            }

            // Add any newly pending PDFs for the current message
            // (Images are handled by estimation, text files are part of userPromptText)
            if (currentPendingPDFs && currentPendingPDFs.length > 0) {
                currentPendingPDFs.forEach(pdf => {
                    itemsForApiCount.push({ type: 'pdf', uri: pdf.fileId, mimeType: pdf.mimeType });
                });
            }
        }

        return itemsForApiCount;

    }, [currentChatMessages, userPromptText, currentPendingPDFs, isSending]);
}

