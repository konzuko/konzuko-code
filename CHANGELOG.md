TODO
---

- FIX prompts 

- edit button
- commit button
- specift kind of codebase
- token warning signal
- continue chat button
{e.g.  the controls buttons dont work - we've made an error in this latest code generation, or the essential files, or both 

i like where we are with the incorporation of the new music player but these last few things needs to be sorted out 

BUT for now, provide a comprehensive detailing of what we've done so far, our main goal, and things we've tried, and where we are at right now + include ANY and ALL KEY DETAILS of this chat. you dont need to provide any code from the files - i'll provide it in the new chat i start - i need to start a new chat because we're running out of context window
}
{ summary needs to identify fixes done so far, struggles user has had, and latest full code file}
- fix grid
- TOKEN COUNTER IS FUCKED - FIX IT - seems we were getting incoherent with openai models at 70,000 tokens, so we can likely go al the way up to 50,000
- COPY PASTE situation likely worth explaining the issue to o1 and r1 to see what they make of a solution. if we solve this, it's game over. - if necessary, theres also the option of finetuning models via openai, or just r1/v3 tbh

- debugging button - which only returns solutions to fixes but not code
also explores how the error may have occured and future problems and fixes if we go on
versus if we refactor

- new feature button - with a prompt that explores the path to the feature, inlcuding potential problems and clashes with current code
(will need to figure out how this will fit in with the current Develop button)


- ability to specify and save to one particular file per chat - a kind of @list.html for example - should eb able to select it from the system file menu
the idea being that you're generally working on a per file basis

- a small llm that check if your prompt makes sense before it's sent - under the hood

CHANGES
---