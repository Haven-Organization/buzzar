import { FormEvent } from "react";

import { Room } from "../../../../matrix";
import { sendChatMessage } from "../../../hooks/useChat";
import { useTypingNotifier } from "../../../hooks/useTyping";

import "./WorldChatComposer.css";

interface IWorldChatComposer {
  room: Room;
}

export function WorldChatComposer({ room }: IWorldChatComposer) {
  const typing = useTypingNotifier(room.id);
  const handleSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    typing?.stopped();
    const target = ev.target as typeof ev.target & {
      message: { value: string };
    };
    const message = target.message.value.trim();
    if (message === "") return;
    target.message.value = "";
    sendChatMessage(room, message);
  };

  return (
    <form className="WorldChatComposer grow" onSubmit={handleSubmit}>
      <input
        className="Text Text-b2 Text--world Text-regular"
        name="message"
        type="text"
        placeholder=""
        autoComplete="off"
        onInput={(e) => typing?.typed(!!e.currentTarget.value.trim())}
        onBlur={() => typing?.stopped()}
        autoFocus
      />
    </form>
  );
}
