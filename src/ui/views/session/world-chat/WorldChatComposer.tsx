import { FormEvent } from "react";
import { ComposerViewModel } from "@thirdroom/hydrogen-view-sdk";

import { useTypingNotifier } from "../../../hooks/useTyping";

import "./WorldChatComposer.css";

interface IWorldChatComposer {
  composerViewModel: ComposerViewModel;
  /** Buzzar: for typing notifications. */
  roomId?: string;
}

export function WorldChatComposer({ composerViewModel, roomId }: IWorldChatComposer) {
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
