CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`location_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`practitioner_id` text,
	`starts_at` integer NOT NULL,
	`duration_minutes` integer DEFAULT 15 NOT NULL,
	`status` text DEFAULT 'BOOKED' NOT NULL,
	`reason` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_practice_loc_time_idx` ON `appointments` (`practice_id`,`location_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_patient_idx` ON `appointments` (`patient_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer,
	`practice_id` text,
	`actor_user_id` text,
	`actor_role` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`location_id` text,
	`metadata` text,
	`ip` text,
	`user_agent` text,
	`prev_hash` text,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_practice_idx` ON `audit_logs` (`practice_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `claim_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`tariff_code` text NOT NULL,
	`description` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`icd10_code` text,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_lines_claim_idx` ON `claim_lines` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claim_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`response_type` text NOT NULL,
	`outcome` text,
	`message` text,
	`approved_cents` integer,
	`paid_cents` integer,
	`patient_portion_cents` integer,
	`payload_json` text,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claim_responses_claim_idx` ON `claim_responses` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claim_tracking_events` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `claim_tracking_claim_idx` ON `claim_tracking_events` (`claim_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`practitioner_id` text,
	`scheme_id` text NOT NULL,
	`scheme_option_id` text,
	`status` text DEFAULT 'NOT_SUBMITTED' NOT NULL,
	`claimed_cents` integer DEFAULT 0 NOT NULL,
	`approved_cents` integer,
	`scheme_paid_cents` integer DEFAULT 0 NOT NULL,
	`patient_portion_cents` integer DEFAULT 0 NOT NULL,
	`adapter_id` text,
	`external_reference` text,
	`submitted_by_user_id` text,
	`submitted_at` integer,
	`last_response_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheme_id`) REFERENCES `medical_schemes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheme_option_id`) REFERENCES `medical_scheme_options`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_invoice_uq` ON `claims` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `claims_practice_status_idx` ON `claims` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `encounter_diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`icd10_code` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`icd10_code`) REFERENCES `icd10_codes`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `encounter_diagnoses_enc_idx` ON `encounter_diagnoses` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `encounter_items` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`tariff_code` text NOT NULL,
	`description` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `encounter_items_enc_idx` ON `encounter_items` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `encounter_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`note` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounter_notes_version_uq` ON `encounter_notes` (`encounter_id`,`version`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`location_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`practitioner_id` text,
	`appointment_id` text,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`checked_in_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`closed_at` integer,
	`is_cross_location` integer DEFAULT false NOT NULL,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practitioner_id`) REFERENCES `practitioners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `encounters_practice_status_idx` ON `encounters` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `encounters_location_status_idx` ON `encounters` (`location_id`,`status`);--> statement-breakpoint
CREATE INDEX `encounters_patient_idx` ON `encounters` (`patient_id`);--> statement-breakpoint
CREATE INDEX `encounters_practice_patient_loc_idx` ON `encounters` (`practice_id`,`patient_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `icd10_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`chapter` text
);
--> statement-breakpoint
CREATE INDEX `icd10_description_idx` ON `icd10_codes` (`description`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`role` text NOT NULL,
	`location_ids` text DEFAULT '[]' NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_practice_email_idx` ON `invitations` (`practice_id`,lower("email"));--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`tariff_code` text NOT NULL,
	`description` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`location_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`invoice_number` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`adjusted_cents` integer DEFAULT 0 NOT NULL,
	`issued_at` integer,
	`voided_at` integer,
	`void_reason` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_practice_number_uq` ON `invoices` (`practice_id`,`invoice_number`);--> statement-breakpoint
CREATE INDEX `invoices_practice_status_idx` ON `invoices` (`practice_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_encounter_idx` ON `invoices` (`encounter_id`);--> statement-breakpoint
CREATE INDEX `invoices_patient_idx` ON `invoices` (`patient_id`);--> statement-breakpoint
CREATE TABLE `location_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`location_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_memberships_uq` ON `location_memberships` (`membership_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `location_memberships_location_idx` ON `location_memberships` (`location_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_practice_name_uq` ON `locations` (`practice_id`,lower("name"));--> statement-breakpoint
CREATE INDEX `locations_practice_idx` ON `locations` (`practice_id`);--> statement-breakpoint
CREATE TABLE `medical_scheme_options` (
	`id` text PRIMARY KEY NOT NULL,
	`scheme_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	FOREIGN KEY (`scheme_id`) REFERENCES `medical_schemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_scheme_options_uq` ON `medical_scheme_options` (`scheme_id`,`code`);--> statement-breakpoint
CREATE TABLE `medical_schemes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_schemes_code_uq` ON `medical_schemes` (`code`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_practice_user_uq` ON `memberships` (`practice_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link_path` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_practice_idx` ON `notifications` (`practice_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `patient_location_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`location_id` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_location_assignments_uq` ON `patient_location_assignments` (`patient_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `patient_medical_aid` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`scheme_id` text NOT NULL,
	`scheme_option_id` text,
	`membership_number` text NOT NULL,
	`dependent_code` text,
	`main_member_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scheme_id`) REFERENCES `medical_schemes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scheme_option_id`) REFERENCES `medical_scheme_options`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_medical_aid_uq` ON `patient_medical_aid` (`patient_id`);--> statement-breakpoint
CREATE TABLE `patient_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`trigger_encounter_count` integer,
	`requested_by_user_id` text,
	`approved_by_user_id` text,
	`reason` text,
	`decision_note` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_transfers_patient_idx` ON `patient_transfers` (`patient_id`,`status`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`home_location_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`date_of_birth` text,
	`gender` text,
	`phone` text,
	`email` text,
	`id_number` text,
	`address` text,
	`notes` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`home_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patients_practice_name_idx` ON `patients` (`practice_id`,`last_name`,`first_name`);--> statement-breakpoint
CREATE INDEX `patients_practice_home_loc_idx` ON `patients` (`practice_id`,`home_location_id`);--> statement-breakpoint
CREATE TABLE `payment_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_adjustments_invoice_idx` ON `payment_adjustments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`payer_type` text DEFAULT 'PATIENT' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`reference` text,
	`received_by_user_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`reversed_at` integer,
	`reversed_by_user_id` text,
	`reversal_reason` text,
	`claim_id` text,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reversed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `payments_practice_idx` ON `payments` (`practice_id`,`received_at`);--> statement-breakpoint
CREATE TABLE `practices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`practice_number` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`vat_rate_bps` integer DEFAULT 0 NOT NULL,
	`transfer_threshold` integer DEFAULT 2 NOT NULL,
	`claims_adapter_id` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practices_number_uq` ON `practices` (`practice_number`);--> statement-breakpoint
CREATE TABLE `practitioners` (
	`id` text PRIMARY KEY NOT NULL,
	`practice_id` text NOT NULL,
	`user_id` text NOT NULL,
	`hpcsa_number` text,
	`discipline` text DEFAULT 'General Practitioner' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practitioners_user_practice_uq` ON `practitioners` (`practice_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `practitioners_practice_idx` ON `practitioners` (`practice_id`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text,
	`email` text,
	`ip` text,
	`user_agent` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_type_idx` ON `security_events` (`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`support_grant_id` text,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `support_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_admin_user_id` text NOT NULL,
	`practice_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`starts_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`platform_admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`practice_id`) REFERENCES `practices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `support_grants_practice_idx` ON `support_access_grants` (`practice_id`,`status`);--> statement-breakpoint
CREATE TABLE `tariff_items` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`default_price_cents` integer DEFAULT 0 NOT NULL,
	`category` text DEFAULT 'CONSULTATION' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tariff_items_code_uq` ON `tariff_items` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`platform_role` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (lower("email"));