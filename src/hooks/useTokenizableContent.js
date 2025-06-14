/* src/hooks/useTokenizableContent.js */
// src/hooks/useTokenizableContent.js
import { useMemo } from 'preact/hooks';

const useMemoizedMessageItems = (messages) => {
    return useMemo(() => {
        if (!messages || messages.length === 0) return [];
        
        const messageItems = [];
        messages.forEach(msg => {
            const contentBlocks = Array.isArray(msg.content)
                ? msg.content
                : [{ type: 'text', text: String(msg.content ?? '') }];

            contentBlocks.forEach(block => {
                if (block.type === 'text' && block.text && String(block.text).trim() !== "") {
                    messageItems.push({ type: 'text', value: block.text });
                } else if (block.type === 'file' && block.file?.file_id && block.file?.mime_type && block.file.mime_type.includes('pdf')) {
                    messageItems.push({ type: 'pdf', uri: block.file.file_id, mimeType: block.file.mime_type });
                }
            });
        });
        return messageItems;
    }, [messages]);
};

export function useTokenizableContent(
    currentChatMessages,
    formText,
    fileText,
    currentPendingPDFs,
    isSending
) {
    const memoizedMessageItems = useMemoizedMessageItems(currentChatMessages);

    return useMemo(() => {
        const itemsForApiCount = [...memoizedMessageItems];

        if (!isSending) {
            const userPrompt = [formText, fileText].filter(Boolean).join('\n\n');
            if (userPrompt) {
                itemsForApiCount.push({ type: 'text', value: userPrompt });
            }
            if (currentPendingPDFs && currentPendingPDFs.length > 0) {
                currentPendingPDFs.forEach(pdf => {
                    itemsForApiCount.push({ type: 'pdf', uri: pdf.fileId, mimeType: pdf.mimeType });
                });
            }
        }
        return itemsForApiCount;

    }, [memoizedMessageItems, formText, fileText, currentPendingPDFs, isSending]);
}
