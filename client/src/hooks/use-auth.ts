import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { apiRequest } from "@/lib/queryClient";

interface AuthResponse {
  success: boolean;
  user: User;
}

async function fetchSession(): Promise<User | null> {
  const response = await fetch("/api/auth/session", {
    credentials: "include",
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data.user || null;
}

interface LoginParams {
  username: string;
  password: string;
}

interface RegisterParams {
  username: string;
  password: string;
  email: string;
  stakePlatform: "us" | "com";
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const loginMutation = useMutation({
    mutationFn: async (params: LoginParams): Promise<AuthResponse> => {
      const res = await apiRequest("POST", "/api/auth/login", params);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/session"], data.user);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (params: RegisterParams): Promise<AuthResponse> => {
      const res = await apiRequest("POST", "/api/auth/register", params);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/session"], data.user);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/session"], null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    register: registerMutation.mutate,
    registerAsync: registerMutation.mutateAsync,
    isRegistering: registerMutation.isPending,
    registerError: registerMutation.error,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    refetchUser: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] }),
  };
}
