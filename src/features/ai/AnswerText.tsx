/** A piece of an answer: plain text, or the inside of a fenced code block. */
type AnswerPart = { code: boolean; text: string };

/** Splits an answer on ``` fence lines; an unclosed fence runs to the end. */
function answerParts(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let code = false;
  let lines: string[] = [];
  const flush = () => {
    const text = code ? lines.join("\n") : lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) parts.push({ code, text });
    lines = [];
  };
  for (const line of answer.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush();
      code = !code;
    } else {
      lines.push(line);
    }
  }
  flush();
  return parts;
}

/** An AI answer as React text nodes only (never HTML): line breaks kept, code in monospace blocks (S8). */
export function AnswerText({ answer }: { answer: string }) {
  return (
    <div className="assistant__reply" aria-label="Answer">
      {answerParts(answer).map((part, i) =>
        part.code ? (
          <pre key={i} className="assistant__code">
            {part.text}
          </pre>
        ) : (
          <p key={i} className="assistant__text">
            {part.text.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
