import { FormEvent } from "react";
import { ComposerViewModel } from "@thirdroom/hydrogen-view-sdk";

import { useTypingNotifier } from "../../../hooks/useTyping";
import { IconButton } from "../../../atoms/button/IconButton";
import SendIC from "../../../../../res/ic/send.svg";
import "./ChatComposer.css";

interface ChatComposerProps {
  composerViewModel: ComposerViewModel;
  /** Buzzar: for typing notifications. */
  roomId?: string;
}

export function ChatComposer({ composerViewModel, roomId }: ChatComposerProps) {
  const typing = useTypingNotifier(roomId);
  const handleSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    typing?.stopped();
    const target = ev.target as typeof ev.target & {
      message: { value: string };
    };
    const message = target.message.value.trim();
    if (message === "") return;
    target.message.value = "";
    composerViewModel.sendMessage(message);
  };

  return (
    <div className="ChatComposer flex">
      <form className="grow flex items-center" onSubmit={handleSubmit}>
        <input
          className="Text Text-b1 Text--surface Text--regular grow"
          name="message"
          type="text"
          placeholder="Send a message..."
          autoComplete="off"
          onInput={(e) => typing?.typed(!!e.currentTarget.value.trim())}
          onBlur={() => typing?.stopped()}
          autoFocus
        />
        <IconButton iconSrc={SendIC} label="Send Message" type="submit" />
      </form>
    </div>
  );
}
