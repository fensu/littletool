export type SshConnection = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
};

export type SshConnectionForm = {
  id: number | null;
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
};

export type SshSessionSnapshot = {
  connectionId: number;
  connected: boolean;
  output: string;
  error?: string | null;
  lastUpdatedMs: number;
};

export type SshOutputEvent = {
  connectionId: number;
  data: string;
};

export type SshStatusEvent = {
  connectionId: number;
  connected: boolean;
  error?: string | null;
};

export const DEFAULT_SSH_FORM: SshConnectionForm = {
  id: null,
  name: "",
  host: "",
  port: "22",
  username: "",
  password: "",
};
