-- ho.ko AI.nalytics - canonical database schema
-- Source of truth for the current PostgreSQL structure; generated from the live catalog at 2026-11-16T16:23:53Z.
-- Schema only: no row data, credentials, owners or grants. Permission assignments are tracked in migrations.

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: kanban; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA kanban;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: actor_type; Type: TYPE; Schema: kanban; Owner: -
--

CREATE TYPE kanban.actor_type AS ENUM (
    'user',
    'client'
);


--
-- Name: card_status; Type: TYPE; Schema: kanban; Owner: -
--

CREATE TYPE kanban.card_status AS ENUM (
    'produce',
    'doing',
    'review',
    'approval',
    'changes',
    'approved',
    'scheduled',
    'published'
);


--
-- Name: comment_target; Type: TYPE; Schema: kanban; Owner: -
--

CREATE TYPE kanban.comment_target AS ENUM (
    'comment',
    'design',
    'text',
    'both'
);


--
-- Name: role_key; Type: TYPE; Schema: kanban; Owner: -
--

CREATE TYPE kanban.role_key AS ENUM (
    'briefing',
    'design',
    'text',
    'review',
    'schedule'
);


--
-- Name: week_code; Type: TYPE; Schema: kanban; Owner: -
--

CREATE TYPE kanban.week_code AS ENUM (
    'S1',
    'S2',
    'S3',
    'S4'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: board; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.board (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_account bigint NOT NULL,
    name text DEFAULT 'Quadro principal'::text NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: board_column; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.board_column (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer NOT NULL,
    color text DEFAULT '#8592a3'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: card; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    id_account bigint NOT NULL,
    id_customer integer,
    title text NOT NULL,
    week text DEFAULT 'S1'::text NOT NULL,
    due_date date,
    copy_text text,
    column_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    created_by_user_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_kanban_card_week CHECK ((week = ANY (ARRAY['S1'::text, 'S2'::text, 'S3'::text, 'S4'::text])))
);


--
-- Name: card_art; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_art (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_id uuid NOT NULL,
    s3_key text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: card_assignee; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_assignee (
    card_id uuid NOT NULL,
    assignee_user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: card_comment; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_comment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_id uuid NOT NULL,
    actor_type text DEFAULT 'client'::text NOT NULL,
    author text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_kanban_comment_actor CHECK ((actor_type = ANY (ARRAY['user'::text, 'client'::text])))
);


--
-- Name: card_label; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.card_label (
    card_id uuid NOT NULL,
    label_id uuid NOT NULL
);


--
-- Name: client_profile; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.client_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_user integer NOT NULL,
    id_customer integer NOT NULL,
    role_briefing_name text,
    role_design_name text,
    role_text_name text,
    role_review_name text,
    role_schedule_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    external_token text
);


--
-- Name: label; Type: TABLE; Schema: kanban; Owner: -
--

CREATE TABLE kanban.label (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_account bigint NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#696cff'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id_account bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accounts_id_account_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_account_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_account_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_account_seq OWNED BY public.accounts.id_account;


--
-- Name: customer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer (
    id_customer integer NOT NULL,
    id_user integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    name character varying(255),
    email character varying(255),
    agent_data bytea,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id_facebook_page character varying(20),
    access_token_page_facebook text,
    phone character varying(15),
    company character varying(50),
    id_instagram_page character varying(20),
    access_token_page_instagram text,
    id_googleanalytics_property text,
    id_linkedin_organization text,
    status text DEFAULT 'active'::text NOT NULL,
    deactivated_at timestamp with time zone
);


--
-- Name: customer_activation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_activation (
    id_activation uuid DEFAULT gen_random_uuid() NOT NULL,
    id_customer integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customer_id_customer_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_id_customer_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_id_customer_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_id_customer_seq OWNED BY public.customer.id_customer;


--
-- Name: customer_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_customer integer NOT NULL,
    platform text NOT NULL,
    oauth_account_id text,
    access_token text,
    refresh_token text,
    expires_at timestamp with time zone,
    refresh_expires_at timestamp with time zone,
    scopes text,
    resource_id text,
    resource_name text,
    resource_type text,
    resource_access_token text,
    status text DEFAULT 'connected'::text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_verification_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: email_verification_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_verification_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_verification_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_verification_tokens_id_seq OWNED BY public.email_verification_tokens.id;


--
-- Name: facebook; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facebook (
    id_customer integer NOT NULL,
    data timestamp with time zone DEFAULT now(),
    page_impressions integer,
    page_impressions_unique integer,
    page_follows integer
);


--
-- Name: general_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_keys (
    id_meta_app character varying(20),
    secret_meta_app character varying(40)
);


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id_goal integer NOT NULL,
    id_user integer NOT NULL,
    id_customer integer NOT NULL,
    platform_name character varying(50) NOT NULL,
    tipo_meta character varying(100) NOT NULL,
    title character varying(150) NOT NULL,
    descricao text NOT NULL,
    data_inicio date NOT NULL,
    data_fim date NOT NULL,
    kpis jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'ativo'::character varying NOT NULL,
    analysis_text text,
    analysis_generated_at timestamp with time zone,
    achieved boolean,
    achieved_score numeric(5,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: goals_id_goal_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.goals_id_goal_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: goals_id_goal_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.goals_id_goal_seq OWNED BY public.goals.id_goal;


--
-- Name: google_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_analytics (
    id_customer integer NOT NULL,
    data timestamp with time zone NOT NULL,
    impressions integer NOT NULL,
    traffic_direct integer NOT NULL,
    traffic_organic_search integer NOT NULL,
    traffic_organic_social integer NOT NULL,
    search_volume integer NOT NULL
);


--
-- Name: instagram; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram (
    id_customer integer NOT NULL,
    data timestamp with time zone NOT NULL,
    reach integer NOT NULL,
    views integer NOT NULL,
    followers integer NOT NULL
);


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    id_invite bigint NOT NULL,
    id_account bigint NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_by_user_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invites_id_invite_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invites_id_invite_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invites_id_invite_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invites_id_invite_seq OWNED BY public.invites.id_invite;


--
-- Name: linkedin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linkedin (
    id integer NOT NULL,
    id_customer integer NOT NULL,
    data date NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    followers integer DEFAULT 0 NOT NULL
);


--
-- Name: linkedin_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.linkedin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: linkedin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.linkedin_id_seq OWNED BY public.linkedin.id;


--
-- Name: member_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_roles (
    id_team_member bigint NOT NULL,
    id_role bigint NOT NULL
);


--
-- Name: oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    id_customer integer NOT NULL,
    platform text NOT NULL,
    nonce text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id_permission bigint NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    group_name text NOT NULL
);


--
-- Name: permissions_id_permission_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permissions_id_permission_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permissions_id_permission_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permissions_id_permission_seq OWNED BY public.permissions.id_permission;


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id_plan integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(80) NOT NULL,
    stripe_product_id character varying(255) NOT NULL,
    stripe_price_id character varying(255) NOT NULL,
    amount_cents integer NOT NULL,
    currency character varying(10) DEFAULT 'brl'::character varying,
    "interval" character varying(10) DEFAULT 'month'::character varying,
    features jsonb,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: plans_id_plan_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plans_id_plan_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plans_id_plan_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plans_id_plan_seq OWNED BY public.plans.id_plan;


--
-- Name: promotion_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_codes (
    code text NOT NULL,
    stripe_promotion_code_id character varying(255) NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id_role bigint NOT NULL,
    id_permission bigint NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id_role bigint NOT NULL,
    id_account bigint NOT NULL,
    name text NOT NULL,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles_id_role_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_role_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_role_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_role_seq OWNED BY public.roles.id_role;


--
-- Name: stripe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_events (
    id integer NOT NULL,
    stripe_event_id character varying(255) NOT NULL,
    type character varying(120) NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp without time zone DEFAULT now()
);


--
-- Name: stripe_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stripe_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stripe_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stripe_events_id_seq OWNED BY public.stripe_events.id;


--
-- Name: subscription_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_invoices (
    id integer NOT NULL,
    id_user integer NOT NULL,
    stripe_invoice_id character varying(255) NOT NULL,
    status character varying(30) NOT NULL,
    amount_due_cents integer NOT NULL,
    hosted_invoice_url text,
    created_at timestamp without time zone NOT NULL,
    period_start timestamp without time zone,
    period_end timestamp without time zone
);


--
-- Name: subscription_invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subscription_invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subscription_invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subscription_invoices_id_seq OWNED BY public.subscription_invoices.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id_team_member bigint NOT NULL,
    id_account bigint NOT NULL,
    id_user bigint NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_at timestamp with time zone,
    joined_at timestamp with time zone,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: team_members_id_team_member_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_members_id_team_member_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_members_id_team_member_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_members_id_team_member_seq OWNED BY public.team_members.id_team_member;


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id_user integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    name character varying(255),
    email character varying(255),
    password character varying(255) NOT NULL,
    foto_perfil text,
    stripe_customer_id character varying(255),
    stripe_subscription_id character varying(255),
    subscription_status character varying(30),
    plan_code character varying(50),
    stripe_price_id character varying(255),
    current_period_start timestamp without time zone,
    current_period_end timestamp without time zone,
    trial_start timestamp without time zone,
    trial_end timestamp without time zone,
    cancel_at timestamp without time zone,
    cancel_at_period_end boolean DEFAULT false,
    email_verified boolean DEFAULT false NOT NULL,
    stripe_extra_item_id text,
    id_account bigint NOT NULL
);


--
-- Name: user_id_user_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_id_user_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_user_seq1; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_id_user_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_id_user_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_id_user_seq1 OWNED BY public."user".id_user;


--
-- Name: user_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_keys (
    id integer NOT NULL,
    id_user integer,
    access_token_instagram text,
    access_token_facebook text,
    id_user_facebook character varying(20),
    id_user_instagram character varying(20),
    access_token_googleanalytics text,
    refresh_token_googleanalytics text,
    id_user_googleanalytics character varying(64),
    expires_at timestamp with time zone,
    access_token_youtube text,
    refresh_token_youtube text,
    id_user_youtube character varying(64),
    expires_at_youtube timestamp with time zone,
    expires_at_facebook timestamp with time zone,
    expires_at_instagram timestamp with time zone,
    access_token_linkedin text,
    refresh_token_linkedin text,
    expires_at_linkedin timestamp without time zone,
    id_user_linkedin text,
    refresh_token_expires_at_linkedin timestamp with time zone
);


--
-- Name: user_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_keys_id_seq OWNED BY public.user_keys.id;


--
-- Name: accounts id_account; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id_account SET DEFAULT nextval('public.accounts_id_account_seq'::regclass);


--
-- Name: customer id_customer; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer ALTER COLUMN id_customer SET DEFAULT nextval('public.customer_id_customer_seq'::regclass);


--
-- Name: email_verification_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens ALTER COLUMN id SET DEFAULT nextval('public.email_verification_tokens_id_seq'::regclass);


--
-- Name: goals id_goal; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals ALTER COLUMN id_goal SET DEFAULT nextval('public.goals_id_goal_seq'::regclass);


--
-- Name: invites id_invite; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites ALTER COLUMN id_invite SET DEFAULT nextval('public.invites_id_invite_seq'::regclass);


--
-- Name: linkedin id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin ALTER COLUMN id SET DEFAULT nextval('public.linkedin_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: permissions id_permission; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id_permission SET DEFAULT nextval('public.permissions_id_permission_seq'::regclass);


--
-- Name: plans id_plan; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans ALTER COLUMN id_plan SET DEFAULT nextval('public.plans_id_plan_seq'::regclass);


--
-- Name: roles id_role; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id_role SET DEFAULT nextval('public.roles_id_role_seq'::regclass);


--
-- Name: stripe_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events ALTER COLUMN id SET DEFAULT nextval('public.stripe_events_id_seq'::regclass);


--
-- Name: subscription_invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices ALTER COLUMN id SET DEFAULT nextval('public.subscription_invoices_id_seq'::regclass);


--
-- Name: team_members id_team_member; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members ALTER COLUMN id_team_member SET DEFAULT nextval('public.team_members_id_team_member_seq'::regclass);


--
-- Name: user id_user; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user" ALTER COLUMN id_user SET DEFAULT nextval('public.user_id_user_seq1'::regclass);


--
-- Name: user_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keys ALTER COLUMN id SET DEFAULT nextval('public.user_keys_id_seq'::regclass);


--
-- Name: board_column board_column_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.board_column
    ADD CONSTRAINT board_column_pkey PRIMARY KEY (id);


--
-- Name: board board_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.board
    ADD CONSTRAINT board_pkey PRIMARY KEY (id);


--
-- Name: card_art card_art_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_art
    ADD CONSTRAINT card_art_pkey PRIMARY KEY (id);


--
-- Name: card_art card_art_s3_key_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_art
    ADD CONSTRAINT card_art_s3_key_key UNIQUE (s3_key);


--
-- Name: card_assignee card_assignee_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_assignee
    ADD CONSTRAINT card_assignee_pkey PRIMARY KEY (card_id, assignee_user_id);


--
-- Name: card_comment card_comment_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_pkey PRIMARY KEY (id);


--
-- Name: card_label card_label_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_label
    ADD CONSTRAINT card_label_pkey PRIMARY KEY (card_id, label_id);


--
-- Name: card card_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_pkey PRIMARY KEY (id);


--
-- Name: client_profile client_profile_id_customer_key; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.client_profile
    ADD CONSTRAINT client_profile_id_customer_key UNIQUE (id_customer);


--
-- Name: client_profile client_profile_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.client_profile
    ADD CONSTRAINT client_profile_pkey PRIMARY KEY (id);


--
-- Name: label label_pkey; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.label
    ADD CONSTRAINT label_pkey PRIMARY KEY (id);


--
-- Name: board_column uq_kanban_board_column_position; Type: CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.board_column
    ADD CONSTRAINT uq_kanban_board_column_position UNIQUE (board_id, "position");


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id_account);


--
-- Name: customer_activation customer_activation_id_customer_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activation
    ADD CONSTRAINT customer_activation_id_customer_key UNIQUE (id_customer);


--
-- Name: customer_activation customer_activation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activation
    ADD CONSTRAINT customer_activation_pkey PRIMARY KEY (id_activation);


--
-- Name: customer_integrations customer_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_integrations
    ADD CONSTRAINT customer_integrations_pkey PRIMARY KEY (id);


--
-- Name: customer customer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT customer_pkey PRIMARY KEY (id_customer);


--
-- Name: email_verification_tokens email_verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_verification_tokens email_verification_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_token_key UNIQUE (token);


--
-- Name: facebook facebook_unique_customer_date; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook
    ADD CONSTRAINT facebook_unique_customer_date UNIQUE (id_customer, data);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id_goal);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id_invite);


--
-- Name: linkedin linkedin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin
    ADD CONSTRAINT linkedin_pkey PRIMARY KEY (id);


--
-- Name: member_roles member_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_pkey PRIMARY KEY (id_team_member, id_role);


--
-- Name: oauth_states oauth_states_nonce_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_nonce_key UNIQUE (nonce);


--
-- Name: oauth_states oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id_permission);


--
-- Name: plans plans_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_code_key UNIQUE (code);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id_plan);


--
-- Name: promotion_codes promotion_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_codes
    ADD CONSTRAINT promotion_codes_pkey PRIMARY KEY (code);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id_role, id_permission);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id_role);


--
-- Name: stripe_events stripe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);


--
-- Name: stripe_events stripe_events_stripe_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_events
    ADD CONSTRAINT stripe_events_stripe_event_id_key UNIQUE (stripe_event_id);


--
-- Name: subscription_invoices subscription_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_pkey PRIMARY KEY (id);


--
-- Name: subscription_invoices subscription_invoices_stripe_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id_team_member);


--
-- Name: customer_integrations uq_customer_platform; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_integrations
    ADD CONSTRAINT uq_customer_platform UNIQUE (id_customer, platform);


--
-- Name: user_keys user_keys_id_user_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keys
    ADD CONSTRAINT user_keys_id_user_unique UNIQUE (id_user);


--
-- Name: user_keys user_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keys
    ADD CONSTRAINT user_keys_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id_user);


--
-- Name: idx_client_profile_customer; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_client_profile_customer ON kanban.client_profile USING btree (id_customer);


--
-- Name: idx_client_profile_user; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_client_profile_user ON kanban.client_profile USING btree (id_user);


--
-- Name: idx_kanban_board_column_board; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_board_column_board ON kanban.board_column USING btree (board_id, "position");


--
-- Name: idx_kanban_card_account; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_card_account ON kanban.card USING btree (id_account);


--
-- Name: idx_kanban_card_art_card; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_card_art_card ON kanban.card_art USING btree (card_id, created_at);


--
-- Name: idx_kanban_card_board_column; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_card_board_column ON kanban.card USING btree (board_id, column_id, "position");


--
-- Name: idx_kanban_card_comment_card; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_card_comment_card ON kanban.card_comment USING btree (card_id, created_at);


--
-- Name: idx_kanban_card_customer; Type: INDEX; Schema: kanban; Owner: -
--

CREATE INDEX idx_kanban_card_customer ON kanban.card USING btree (id_customer);


--
-- Name: ux_kanban_board_default_account; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX ux_kanban_board_default_account ON kanban.board USING btree (id_account) WHERE (is_default = true);


--
-- Name: ux_kanban_client_profile_external_token; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX ux_kanban_client_profile_external_token ON kanban.client_profile USING btree (external_token) WHERE (external_token IS NOT NULL);


--
-- Name: ux_kanban_label_account_name_ci; Type: INDEX; Schema: kanban; Owner: -
--

CREATE UNIQUE INDEX ux_kanban_label_account_name_ci ON kanban.label USING btree (id_account, lower(name));


--
-- Name: customer_integrations_customer_platform_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_integrations_customer_platform_uidx ON public.customer_integrations USING btree (id_customer, platform);


--
-- Name: idx_accounts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_status ON public.accounts USING btree (status);


--
-- Name: idx_customer_integrations_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_integrations_customer ON public.customer_integrations USING btree (id_customer);


--
-- Name: idx_customer_integrations_customer_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_integrations_customer_platform ON public.customer_integrations USING btree (id_customer, platform);


--
-- Name: idx_goals_customer_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_customer_platform ON public.goals USING btree (id_customer, platform_name);


--
-- Name: idx_goals_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_user_created ON public.goals USING btree (id_user, created_at DESC);


--
-- Name: idx_inv_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_account ON public.invites USING btree (id_account);


--
-- Name: idx_inv_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_email_lower ON public.invites USING btree (lower(email));


--
-- Name: idx_mr_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mr_role ON public.member_roles USING btree (id_role);


--
-- Name: idx_oauth_states_customer_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_states_customer_platform ON public.oauth_states USING btree (id_customer, platform);


--
-- Name: idx_roles_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_account ON public.roles USING btree (id_account);


--
-- Name: idx_rp_permission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rp_permission ON public.role_permissions USING btree (id_permission);


--
-- Name: idx_rp_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rp_role ON public.role_permissions USING btree (id_role);


--
-- Name: idx_tm_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tm_account ON public.team_members USING btree (id_account);


--
-- Name: idx_tm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tm_user ON public.team_members USING btree (id_user);


--
-- Name: idx_user_id_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_id_account ON public."user" USING btree (id_account);


--
-- Name: ux_member_roles_one_role_per_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_member_roles_one_role_per_member ON public.member_roles USING btree (id_team_member);


--
-- Name: ux_permissions_code_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_permissions_code_lower ON public.permissions USING btree (lower(code));


--
-- Name: ux_roles_account_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_roles_account_name_lower ON public.roles USING btree (id_account, lower(name));


--
-- Name: ux_tm_account_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tm_account_user ON public.team_members USING btree (id_account, id_user);


--
-- Name: board_column board_column_board_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.board_column
    ADD CONSTRAINT board_column_board_id_fkey FOREIGN KEY (board_id) REFERENCES kanban.board(id) ON DELETE CASCADE;


--
-- Name: board board_id_account_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.board
    ADD CONSTRAINT board_id_account_fkey FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: card_art card_art_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_art
    ADD CONSTRAINT card_art_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id) ON DELETE CASCADE;


--
-- Name: card_assignee card_assignee_assignee_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_assignee
    ADD CONSTRAINT card_assignee_assignee_user_id_fkey FOREIGN KEY (assignee_user_id) REFERENCES public."user"(id_user) ON DELETE CASCADE;


--
-- Name: card_assignee card_assignee_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_assignee
    ADD CONSTRAINT card_assignee_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id) ON DELETE CASCADE;


--
-- Name: card card_board_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_board_id_fkey FOREIGN KEY (board_id) REFERENCES kanban.board(id) ON DELETE CASCADE;


--
-- Name: card card_column_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_column_id_fkey FOREIGN KEY (column_id) REFERENCES kanban.board_column(id) ON DELETE SET NULL;


--
-- Name: card_comment card_comment_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_comment
    ADD CONSTRAINT card_comment_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id) ON DELETE CASCADE;


--
-- Name: card card_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id_user) ON DELETE SET NULL;


--
-- Name: card card_id_account_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_id_account_fkey FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: card card_id_customer_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card
    ADD CONSTRAINT card_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE SET NULL;


--
-- Name: card_label card_label_card_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_label
    ADD CONSTRAINT card_label_card_id_fkey FOREIGN KEY (card_id) REFERENCES kanban.card(id) ON DELETE CASCADE;


--
-- Name: card_label card_label_label_id_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.card_label
    ADD CONSTRAINT card_label_label_id_fkey FOREIGN KEY (label_id) REFERENCES kanban.label(id) ON DELETE CASCADE;


--
-- Name: client_profile client_profile_id_customer_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.client_profile
    ADD CONSTRAINT client_profile_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: label label_id_account_fkey; Type: FK CONSTRAINT; Schema: kanban; Owner: -
--

ALTER TABLE ONLY kanban.label
    ADD CONSTRAINT label_id_account_fkey FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: customer_activation customer_activation_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_activation
    ADD CONSTRAINT customer_activation_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: customer_integrations customer_integrations_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_integrations
    ADD CONSTRAINT customer_integrations_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: email_verification_tokens email_verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id_user) ON DELETE CASCADE;


--
-- Name: instagram fk_customer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram
    ADD CONSTRAINT fk_customer FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer);


--
-- Name: customer fk_customers_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer
    ADD CONSTRAINT fk_customers_user FOREIGN KEY (id_user) REFERENCES public."user"(id_user) ON DELETE CASCADE;


--
-- Name: facebook fk_facebook_customers; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facebook
    ADD CONSTRAINT fk_facebook_customers FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: google_analytics fk_google_analytics_customer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_analytics
    ADD CONSTRAINT fk_google_analytics_customer FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer);


--
-- Name: invites fk_inv_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT fk_inv_account FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: invites fk_inv_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT fk_inv_created_by FOREIGN KEY (created_by_user_id) REFERENCES public."user"(id_user) ON DELETE RESTRICT;


--
-- Name: member_roles fk_mr_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT fk_mr_role FOREIGN KEY (id_role) REFERENCES public.roles(id_role) ON DELETE CASCADE;


--
-- Name: member_roles fk_mr_team_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT fk_mr_team_member FOREIGN KEY (id_team_member) REFERENCES public.team_members(id_team_member) ON DELETE CASCADE;


--
-- Name: roles fk_roles_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT fk_roles_account FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: role_permissions fk_rp_permission; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT fk_rp_permission FOREIGN KEY (id_permission) REFERENCES public.permissions(id_permission) ON DELETE CASCADE;


--
-- Name: role_permissions fk_rp_role; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT fk_rp_role FOREIGN KEY (id_role) REFERENCES public.roles(id_role) ON DELETE CASCADE;


--
-- Name: team_members fk_tm_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT fk_tm_account FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE CASCADE;


--
-- Name: team_members fk_tm_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT fk_tm_user FOREIGN KEY (id_user) REFERENCES public."user"(id_user) ON DELETE CASCADE;


--
-- Name: user fk_user_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT fk_user_account FOREIGN KEY (id_account) REFERENCES public.accounts(id_account) ON DELETE RESTRICT;


--
-- Name: goals goals_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: goals goals_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_id_user_fkey FOREIGN KEY (id_user) REFERENCES public."user"(id_user) ON DELETE CASCADE;


--
-- Name: google_analytics google_analytics_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_analytics
    ADD CONSTRAINT google_analytics_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: linkedin linkedin_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin
    ADD CONSTRAINT linkedin_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer);


--
-- Name: oauth_states oauth_states_id_customer_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_id_customer_fkey FOREIGN KEY (id_customer) REFERENCES public.customer(id_customer) ON DELETE CASCADE;


--
-- Name: subscription_invoices subscription_invoices_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_invoices
    ADD CONSTRAINT subscription_invoices_id_user_fkey FOREIGN KEY (id_user) REFERENCES public."user"(id_user);


--
-- Name: user_keys user_keys_id_user_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_keys
    ADD CONSTRAINT user_keys_id_user_fkey FOREIGN KEY (id_user) REFERENCES public."user"(id_user);


--
-- PostgreSQL database dump complete
--


