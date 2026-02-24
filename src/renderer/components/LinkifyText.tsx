import React from 'react';

interface LinkifyTextProps {
  text: string;
}

// Regex to match URLs
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

export const LinkifyText: React.FC<LinkifyTextProps> = ({ text }) => {
  const parts = text.split(URL_REGEX);

  return (
    <>
      {parts.map((part, index) => {
        if (URL_REGEX.test(part)) {
          // Reset regex lastIndex since we're reusing it
          URL_REGEX.lastIndex = 0;
          return (
            <a
              key={index}
              href={part}
              className="message-link"
              onClick={(e) => {
                e.preventDefault();
                window.clawster.openExternal(part);
              }}
            >
              {part}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
};
