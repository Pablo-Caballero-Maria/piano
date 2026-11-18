/**
 * The page's services, one of each, shared by every component: the REST API (with the login
 * session), the live class link, the sound output, and the class state built on them.
 */
import { ClassState } from "@/state/class-state";
import { api } from "./api";
import { link } from "./link";
import { SoundOutput } from "./sound";

export { api, link };
export const sound = new SoundOutput(link);
export const classState = new ClassState(api, link);
